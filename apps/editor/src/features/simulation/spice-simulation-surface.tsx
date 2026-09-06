import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  type ObjectLocator,
  type ProjectSimulationSetup,
  SimulationSetupSchema,
  parseSimulationExpression,
  type CircuitProject,
  type SimulationExpression,
  type SimulationOutputSpec,
  type SimulationProbeSpec,
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
import { DcResultsExplorer } from "./dc-results-explorer";
import { TransientResultsExplorer } from "./transient-results-explorer";
import { SimulationOutputResults } from "./simulation-output-results";
import {
  deriveSimulationProbeOptions,
  matchSimulationTerminalCurrentProbeOptions,
  matchSimulationVoltageProbeOptions,
  simulationProbeSelectionKey,
  simulationProbeTargetKey,
  type SimulationProbeOption,
} from "./simulation-probe-options";

const RESULT_TABS = [
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

export interface SpiceSimulationSurfaceProps {
  open: boolean;
  maximized: boolean;
  project: CircuitProject;
  activeDocumentId: string;
  draftContext?: {
    readonly setupId: string;
    readonly setupName: string;
    readonly dutDocumentId: string;
    readonly rootDocumentId: string;
  };
  selectedSetupId: string | null;
  onSelectSetupId(setupId: string): void;
  session: BrowserSimulationSession;
  onToggleMaximized(): void;
  onMinimize(): void;
  onExit(): void;
  onSaveSetup(setup: ProjectSimulationSetup): SimulationSetupSaveResult;
  onDeleteSetup(setupId: string): boolean;
  pickNetsActive?: boolean;
  pickedNet?: {
    readonly sequence: number;
    readonly documentId: string;
    readonly netId: string;
    /** Instance ids from the selected Testbench root to this Cell. */
    readonly occurrence?: readonly string[];
  } | null;
  onPickNetsChange?(active: boolean): void;
  pickTerminalsActive?: boolean;
  pickedTerminal?: {
    readonly sequence: number;
    readonly documentId: string;
    readonly instanceId: string;
    readonly pinName: string;
    /** Instance ids from the selected Testbench root to this Cell. */
    readonly occurrence?: readonly string[];
  } | null;
  onPickTerminalsChange?(active: boolean): void;
  onFocusProbe?(
    probe: Extract<SimulationExpression, { kind: "voltage" | "current" }>,
    rootDocumentId?: string,
  ): void;
  onFocusDiagnostic?(locator: ObjectLocator): void;
}

export type SimulationSetupSaveResult =
  | { readonly status: "applied" | "unchanged" }
  | { readonly status: "rejected"; readonly problem: Problem };

interface PreparedPresentation {
  readonly prepared: Prepared;
  readonly outputs: SimulationStructuredInput["outputs"];
  readonly analysisLabel: string;
  readonly rootDocumentId?: string;
}

function legacyProbe(output: SimulationOutputSpec): SimulationProbeSpec | null {
  const expression = output.expression;
  if (expression.kind === "voltage")
    return {
      id: output.id,
      kind: "net-voltage",
      documentId: expression.documentId,
      anchor: structuredClone(expression.anchor),
      occurrence: [...expression.occurrence],
    };
  if (expression.kind === "current")
    return {
      id: output.id,
      kind: "terminal-current",
      documentId: expression.documentId,
      instanceId: expression.instanceId,
      pinName: expression.pinName,
      occurrence: [...expression.occurrence],
    };
  return null;
}

function expressionFromLegacyProbe(
  probe: SimulationProbeSpec,
): Extract<SimulationExpression, { kind: "voltage" | "current" }> {
  return probe.kind === "net-voltage"
    ? {
        kind: "voltage",
        documentId: probe.documentId,
        anchor: structuredClone(probe.anchor),
        occurrence: [...probe.occurrence],
      }
    : {
        kind: "current",
        documentId: probe.documentId,
        instanceId: probe.instanceId,
        pinName: probe.pinName,
        occurrence: [...probe.occurrence],
      };
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
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [run, setRun] = useState<Run>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const preparedPresentations = useRef(new Map<string, PreparedPresentation>());
  const [setupOpen, setSetupOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultTab, setResultTab] = useState<ResultTab>("plot");
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  const [deleteSetupId, setDeleteSetupId] = useState<string>();
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
  const previousSetupId = useRef<string | null>(props.selectedSetupId);
  useEffect(() => {
    if (previousSetupId.current === props.selectedSetupId) return;
    previousSetupId.current = props.selectedSetupId;
    setPrepared(undefined);
    setRun(undefined);
    setProblem(undefined);
    setResultsOpen(false);
    setSetupOpen(true);
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
        setResultTab(preferredResultTab(reply.run));
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
          setupId: selectedSetup!.id,
          expectedStructureRevision: project.structureRevision,
        },
      });
      if (reply.ok && "prepared" in reply) {
        const input = selectedSetup?.input;
        preparedPresentations.current.set(reply.prepared.id, {
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
  const hasDutInstance = Boolean(
    activeCell?.instances.some(
      (instance) => instance.netlist?.binding?.kind === "subcircuit",
    ),
  );
  const artifactGroups = [
    ...(prepared
      ? [
          {
            label: "Prepared files",
            artifacts: prepared.artifacts,
          },
        ]
      : []),
    ...(run
      ? [
          {
            label: "Last run",
            artifacts: run.artifacts,
          },
        ]
      : []),
  ];
  const artifactCategories = ["Netlist", "Results", "Evidence", "Log", "Other"];
  const artifactSections = artifactGroups.flatMap((group) =>
    artifactCategories.flatMap((category) => {
      const artifacts = group.artifacts.filter(
        (artifact) => simulationArtifactCategory(artifact) === category,
      );
      return artifacts.length ? [{ ...group, category, artifacts }] : [];
    }),
  );
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
        : activeProblem.stage === "input"
          ? `${activeProblem.code}: ${activeProblem.message}`
          : "Simulation needs attention. Open Console for details."
    : staleMessage;
  const runPresentation = run
    ? preparedPresentations.current.get(run.preparedId)
    : undefined;
  const analysisLabel = runPresentation?.analysisLabel;
  const presentationProbes =
    runPresentation?.outputs.flatMap((output) => {
      const probe = legacyProbe(output);
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
      version: 2,
      input: selectedSetup
        ? structuredClone(selectedSetup.input)
        : {
            kind: "structured",
            rootDocumentId: props.activeDocumentId,
            analyses: [{ kind: "op" }],
            outputs: [],
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
            className={`simulation-status-chip simulation-status-${run?.state ?? (prepared ? "prepared" : "idle")}`}
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
              {project.simulationSetups.map((setup) => (
                <div
                  key={setup.id}
                  className="simulation-setup-menu-row"
                  data-selected={setup.id === selectedSetup?.id}
                >
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
              disabled={run.state === "cancelling"}
              onClick={() =>
                void session
                  .handle({ operation: "cancel", runId: run.id })
                  .then(receive)
              }
            >
              Cancel run
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
          </header>
          <div className="simulation-results-body">
            {resultTab === "plot" ? (
              <div className="simulation-analysis-view">
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
                          onFocusProbe: (probe: SimulationProbeSpec) =>
                            props.onFocusProbe?.(
                              expressionFromLegacyProbe(probe),
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
                      <DcResultsExplorer
                        key={`dc-${index}`}
                        analysis={analysis}
                        vectors={runPresentation?.prepared.vectors ?? []}
                        probes={presentationProbes}
                        labels={presentationLabels}
                        {...(props.onFocusProbe
                          ? {
                              onFocusProbe: (probe: SimulationProbeSpec) =>
                                props.onFocusProbe?.(
                                  expressionFromLegacyProbe(probe),
                                  runPresentation?.rootDocumentId,
                                ),
                            }
                          : {})}
                      />
                    ))}
                {!run?.outputData &&
                  run?.result?.data?.analyses
                    .filter((analysis) => analysis.analysis === "ac")
                    .map((analysis, index) => (
                      <AcResultsExplorer
                        key={`${run.id}:ac:${index}`}
                        resultKey={`${run.id}:ac:${index}`}
                        analysis={analysis}
                        vectors={runPresentation?.prepared.vectors ?? []}
                        probes={presentationProbes}
                        labels={presentationLabels}
                        {...(props.onFocusProbe
                          ? {
                              onFocusProbe: (probe: SimulationProbeSpec) =>
                                props.onFocusProbe?.(
                                  expressionFromLegacyProbe(probe),
                                  runPresentation?.rootDocumentId,
                                ),
                            }
                          : {})}
                      />
                    ))}
                {!run?.outputData &&
                  run?.result?.data?.analyses
                    .filter((analysis) => analysis.analysis === "tran")
                    .map((analysis, index) => (
                      <TransientResultsExplorer
                        key={`${run.id}:tran:${index}`}
                        resultKey={`${run.id}:tran:${index}`}
                        analysis={analysis}
                        vectors={runPresentation?.prepared.vectors ?? []}
                        probes={presentationProbes}
                        labels={presentationLabels}
                        {...(props.onFocusProbe
                          ? {
                              onFocusProbe: (probe: SimulationProbeSpec) =>
                                props.onFocusProbe?.(
                                  expressionFromLegacyProbe(probe),
                                  runPresentation?.rootDocumentId,
                                ),
                            }
                          : {})}
                      />
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
              <div className="simulation-analysis-view">
                {run?.outputData ? (
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
                ) : null}
                {!run?.outputData &&
                  run?.result?.data?.analyses
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
              <div className="simulation-files-view">
                {artifactSections.map((section) => (
                  <details
                    key={`${section.label}:${section.category}`}
                    className="simulation-artifact-group"
                    aria-label={`${section.label} ${section.category}`}
                    open={section.category === "Results"}
                  >
                    <summary>
                      <strong>{section.category}</strong>
                      <span>{section.label}</span>
                      <small>{section.artifacts.length}</small>
                    </summary>
                    <ul className="simulation-artifact-list">
                      {section.artifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <button onClick={() => void download(artifact)}>
                            {artifact.name}
                          </button>
                          <small>
                            {formatArtifactSize(artifact.byteLength)}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
                {artifactSections.length === 0 ? (
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
  setup,
  onDirty,
  onProblem,
  pickNetsActive,
  pickedNet,
  onPickNetsChange,
  pickTerminalsActive,
  pickedTerminal,
  onPickTerminalsChange,
}: SpiceSimulationSurfaceProps & {
  setup: ProjectSimulationSetup | undefined;
  capabilities: Capabilities | undefined;
  onDirty(value: boolean): void;
  onProblem(value: Problem | undefined): void;
}) {
  const saved = setup?.input.kind === "structured" ? setup.input : undefined;
  const rootId =
    saved?.rootDocumentId ?? draftContext?.rootDocumentId ?? activeDocumentId;
  const [outputs, setOutputs] = useState(saved?.outputs ?? []);
  const [setupName, setSetupName] = useState(
    setup?.name ?? draftContext?.setupName ?? "Setup 1",
  );
  const [expressionText, setExpressionText] = useState("");
  const [expressionLabel, setExpressionLabel] = useState("");
  const [editingOutputId, setEditingOutputId] = useState<string>();
  const root = project.documents.find((d) => d.id === rootId);
  const probeOptions = deriveSimulationProbeOptions(project, rootId);
  const dcSources = (root?.instances ?? []).flatMap((instance) => {
    const binding = instance.netlist?.binding;
    if (
      binding?.kind !== "primitive" ||
      (binding.deviceClass !== "voltage-source" &&
        binding.deviceClass !== "current-source")
    )
      return [];
    return [
      {
        id: instance.id,
        label: `${instance.reference} · ${binding.deviceClass === "voltage-source" ? "Voltage" : "Current"}`,
        unit: binding.deviceClass === "voltage-source" ? "V" : "A",
      },
    ];
  });
  const probeLabels = new Map<string, string>();
  for (const option of [
    ...probeOptions.voltage,
    ...probeOptions.terminalCurrent,
  ]) {
    // The option key is Logical-Net scoped for selection deduplication, while
    // a persisted output keeps its durable object anchor. Both identities
    // describe the same visible target and therefore share one display label.
    probeLabels.set(option.key, option.label);
    probeLabels.set(simulationProbeTargetKey(option.target), option.label);
  }
  const selectedProbeKeys = new Set(
    outputs.flatMap((output) =>
      output.expression.kind === "voltage" ||
      output.expression.kind === "current"
        ? [simulationProbeSelectionKey(project, output.expression)]
        : [],
    ),
  );
  const dc = saved?.analyses.find((a) => a.kind === "dc");
  const ac = saved?.analyses.find((a) => a.kind === "ac");
  const tran = saved?.analyses.find((a) => a.kind === "tran");
  const [dcEnabled, setDcEnabled] = useState(!!dc);
  const [dcSourceId, setDcSourceId] = useState(
    dc?.sourceInstanceId ?? dcSources[0]?.id ?? "",
  );
  const [acEnabled, setAcEnabled] = useState(!!ac);
  const [tranEnabled, setTranEnabled] = useState(!!tran);
  const [profileId, setProfileId] = useState(
    saved?.environment.profileId ?? DEVELOPMENT_PROFILE_ID,
  );
  const rawSaved = setup?.input.kind === "raw" ? setup.input : undefined;
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
  const selectedDcSourceId = dcSources.some(
    (source) => source.id === dcSourceId,
  )
    ? dcSourceId
    : (dcSources[0]?.id ?? "");
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
          "That Net is outside this Setup's Testbench. Choose it from the Output list or create a Setup for the intended Testbench.",
        ),
      );
      return;
    }
    const key = simulationProbeSelectionKey(project, option.target);
    if (
      outputs.some(
        (output) =>
          (output.expression.kind === "voltage" ||
            output.expression.kind === "current") &&
          simulationProbeSelectionKey(project, output.expression) === key,
      )
    )
      return;
    setOutputs((current) => [...current, outputFromOption(option, current)]);
    onDirty(true);
    setPickCandidates([]);
    onProblem(undefined);
  }, [pickedNet?.sequence]);
  useEffect(() => {
    if (!pickedTerminal) return;
    const candidates = matchSimulationTerminalCurrentProbeOptions(
      probeOptions.terminalCurrent,
      pickedTerminal,
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
          "That terminal is not a connected current target in the selected Testbench occurrence.",
        ),
      );
      return;
    }
    const key = simulationProbeSelectionKey(project, option.target);
    if (
      outputs.some(
        (output) =>
          (output.expression.kind === "voltage" ||
            output.expression.kind === "current") &&
          simulationProbeSelectionKey(project, output.expression) === key,
      )
    )
      return;
    setOutputs((current) => [...current, outputFromOption(option, current)]);
    onDirty(true);
    setPickCandidates([]);
    onProblem(undefined);
  }, [pickedTerminal?.sequence]);
  useEffect(() => {
    onDirty(false);
  }, []);
  if (rawSaved && !switchFromRaw) {
    return (
      <aside className="simulation-setup-panel" aria-label="Simulation setup">
        <header>
          <div>
            <strong>Raw setup</strong>
          </div>
        </header>
        <div className="simulation-raw-summary">
          <p>
            <strong>{rawSaved.entry}</strong>
          </p>
          <button type="button" onClick={() => setSwitchFromRaw(true)}>
            Switch to structured setup…
          </button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="simulation-setup-panel" aria-label="Simulation setup">
      <header>
        <div>
          <strong>Settings</strong>
        </div>
      </header>
      <form
        onChange={(event) => {
          if (
            (event.target as unknown as { name?: string }).name !== "setupName"
          )
            onDirty(true);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const parsed = SimulationSetupSchema.safeParse({
            version: 2,
            input: {
              kind: "structured",
              rootDocumentId: rootId,
              analyses: [
                ...(data.has("op") ? [{ kind: "op" }] : []),
                ...(data.has("dc")
                  ? [
                      {
                        kind: "dc",
                        sourceInstanceId: data.get("dcSourceInstanceId"),
                        startValue: Number(data.get("dcStartValue")),
                        stopValue: Number(data.get("dcStopValue")),
                        stepValue: Number(data.get("dcStepValue")),
                      },
                    ]
                  : []),
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
              outputs,
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
          const setupName = String(data.get("setupName") ?? "").trim();
          if (!setupName) {
            onProblem(
              uiProblem("SIMULATION_SETUP_INVALID", "Setup name is required"),
            );
            return;
          }
          const setupId =
            setup?.id ??
            draftContext?.setupId ??
            `simulation-setup-${crypto.randomUUID()}`;
          const result = onSaveSetup({
            id: setupId,
            name: setupName,
            ...parsed.data,
          });
          if (result.status !== "rejected") {
            onDirty(false);
            onProblem(undefined);
          } else onProblem(result.problem);
        }}
      >
        <label>
          Setup name
          <input
            name="setupName"
            required
            value={setupName}
            onChange={(event) => setSetupName(event.currentTarget.value)}
            onBlur={() => {
              const name = setupName.trim();
              if (!setup || name === setup.name) return;
              if (!name) {
                setSetupName(setup.name);
                onProblem(
                  uiProblem(
                    "SIMULATION_SETUP_INVALID",
                    "Setup name is required.",
                  ),
                );
                return;
              }
              const result = onSaveSetup({ ...setup, name });
              if (result.status !== "rejected") onProblem(undefined);
              else {
                setSetupName(setup.name);
                onProblem(result.problem);
              }
            }}
          />
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
              name="dc"
              type="checkbox"
              checked={dcEnabled}
              onChange={(event) => setDcEnabled(event.currentTarget.checked)}
            />
            DC
          </label>
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
        {dcEnabled ? (
          <div className="simulation-setup-group simulation-analysis-settings">
            <label>
              DC sweep source
              <select
                name="dcSourceInstanceId"
                required
                value={selectedDcSourceId}
                onChange={(event) => setDcSourceId(event.currentTarget.value)}
              >
                {dcSources.length === 0 ? (
                  <option value="">No independent sources in Testbench</option>
                ) : null}
                {dcSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="simulation-inline-fields columns-3">
              <label>
                Start
                <input
                  name="dcStartValue"
                  type="number"
                  step="any"
                  required
                  defaultValue={dc?.startValue ?? 0}
                />
              </label>
              <label>
                Stop
                <input
                  name="dcStopValue"
                  type="number"
                  step="any"
                  required
                  defaultValue={dc?.stopValue ?? 1.8}
                />
              </label>
              <label>
                Step
                <input
                  name="dcStepValue"
                  type="number"
                  step="any"
                  required
                  defaultValue={dc?.stepValue ?? 0.01}
                />
              </label>
            </div>
            <small>
              Values use{" "}
              {dcSources.find((source) => source.id === selectedDcSourceId)
                ?.unit ?? "the source unit"}
              ; step is a positive magnitude.
            </small>
          </div>
        ) : null}
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
          selectedKeys={selectedProbeKeys}
          onAdd={(option) => {
            setOutputs([...outputs, outputFromOption(option, outputs)]);
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
            aria-label="Choose probe occurrence"
          >
            <legend>Choose occurrence</legend>
            {pickCandidates.map((option) => (
              <button
                type="button"
                key={option.key}
                onClick={() => {
                  setOutputs((current) => [
                    ...current,
                    outputFromOption(option, current),
                  ]);
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
          placeholder="Choose a terminal current"
          options={probeOptions.terminalCurrent}
          selectedKeys={selectedProbeKeys}
          onAdd={(option) => {
            setOutputs([...outputs, outputFromOption(option, outputs)]);
            onDirty(true);
          }}
          trailingAction={
            <button
              type="button"
              className={
                pickTerminalsActive ? "simulation-pick-active" : undefined
              }
              aria-pressed={pickTerminalsActive}
              onClick={() => onPickTerminalsChange?.(!pickTerminalsActive)}
            >
              {pickTerminalsActive ? "Picking Terminals…" : "Pick terminal"}
            </button>
          }
        />
        <small>Positive current enters the selected terminal.</small>
        <fieldset className="simulation-setup-group simulation-expression-editor">
          <legend>Derived expression</legend>
          <div className="simulation-inline-fields columns-2">
            <label>
              Name
              <input
                value={expressionLabel}
                placeholder="Gain"
                onChange={(event) =>
                  setExpressionLabel(event.currentTarget.value)
                }
              />
            </label>
            <label>
              Expression
              <input
                value={expressionText}
                placeholder="db20(Vout / Vin)"
                onChange={(event) =>
                  setExpressionText(event.currentTarget.value)
                }
              />
            </label>
          </div>
          <small>
            Use output names with +, −, ×, ÷, mag, db20, phase, real, imag, or
            abs.
          </small>
          <button
            type="button"
            onClick={() => {
              const label = expressionLabel.trim();
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(label)) {
                onProblem(
                  uiProblem(
                    "SIMULATION_OUTPUT_NAME_INVALID",
                    "Expression names use letters, numbers, and underscores, beginning with a letter or underscore.",
                  ),
                );
                return;
              }
              if (
                outputs.some(
                  (output) =>
                    output.id !== editingOutputId &&
                    output.label.toLowerCase() === label.toLowerCase(),
                )
              ) {
                onProblem(
                  uiProblem(
                    "SIMULATION_OUTPUT_NAME_DUPLICATE",
                    `An output named ${label} already exists.`,
                  ),
                );
                return;
              }
              const symbols = new Map(
                outputs
                  .filter(
                    (output) =>
                      output.id !== editingOutputId &&
                      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(output.label),
                  )
                  .map((output) => [output.label, output.expression] as const),
              );
              const parsed = parseSimulationExpression(expressionText, symbols);
              if (!parsed.ok) {
                onProblem(
                  uiProblem(
                    `SIMULATION_EXPRESSION_${parsed.code}`,
                    `${parsed.message} at character ${parsed.offset + 1}.`,
                  ),
                );
                return;
              }
              setOutputs((current) => {
                const next = {
                  id: editingOutputId ?? crypto.randomUUID(),
                  label,
                  expression: parsed.expression,
                };
                return editingOutputId
                  ? current.map((output) =>
                      output.id === editingOutputId ? next : output,
                    )
                  : [...current, next];
              });
              setExpressionLabel("");
              setExpressionText("");
              setEditingOutputId(undefined);
              onDirty(true);
              onProblem(undefined);
            }}
          >
            {editingOutputId ? "Save expression" : "Add expression"}
          </button>
        </fieldset>
        <ul className="simulation-probe-list" aria-label="Configured Outputs">
          {outputs.map((output) => (
            <li key={output.id}>
              <span>
                <input
                  aria-label={`Output name for ${output.label}`}
                  value={output.label}
                  onChange={(event) => {
                    event.stopPropagation();
                    const label = event.currentTarget.value;
                    setOutputs((current) =>
                      current.map((candidate) =>
                        candidate.id === output.id
                          ? { ...candidate, label }
                          : candidate,
                      ),
                    );
                    onDirty(true);
                  }}
                />
                <small>
                  {describeOutputExpression(output, probeLabels, outputs)}
                </small>
              </span>
              {output.expression.kind !== "voltage" &&
              output.expression.kind !== "current" &&
              formatOutputExpression(output.expression, outputs) ? (
                <button
                  type="button"
                  aria-label={`Edit expression ${output.label}`}
                  onClick={() => {
                    setEditingOutputId(output.id);
                    setExpressionLabel(output.label);
                    setExpressionText(
                      formatOutputExpression(output.expression, outputs)!,
                    );
                  }}
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Remove output"
                onClick={() => {
                  setOutputs(outputs.filter((value) => value.id !== output.id));
                  if (editingOutputId === output.id) {
                    setEditingOutputId(undefined);
                    setExpressionLabel("");
                    setExpressionText("");
                  }
                  onDirty(true);
                }}
              >
                Remove output
              </button>
            </li>
          ))}
        </ul>
        <button type="submit">Apply setup</button>
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

function outputFromOption(
  option: SimulationProbeOption,
  existing: readonly SimulationOutputSpec[],
): SimulationStructuredInput["outputs"][number] {
  const source = option.label.split(" · ").at(-1) ?? "Output";
  const stem = source.replace(/[^A-Za-z0-9_]/gu, "_");
  const base = /^[A-Za-z_]/u.test(stem) ? stem : `Output_${stem}`;
  const used = new Set(existing.map((output) => output.label.toLowerCase()));
  let label = base;
  for (let suffix = 2; used.has(label.toLowerCase()); suffix++)
    label = `${base}_${suffix}`;
  return {
    id: crypto.randomUUID(),
    label,
    expression: structuredClone(option.target),
  };
}

function describeOutputExpression(
  output: SimulationOutputSpec,
  labels: ReadonlyMap<string, string>,
  outputs: readonly SimulationOutputSpec[],
): string {
  const expression = output.expression;
  if (expression.kind === "voltage" || expression.kind === "current")
    return (
      labels.get(simulationProbeTargetKey(expression)) ??
      (expression.kind === "voltage"
        ? "Voltage target unavailable"
        : "Current target unavailable")
    );
  return formatOutputExpression(expression, outputs) ?? "Derived expression";
}

function formatOutputExpression(
  expression: SimulationExpression,
  outputs: readonly SimulationOutputSpec[],
): string | null {
  if (expression.kind === "voltage" || expression.kind === "current") {
    const key = simulationProbeTargetKey(expression);
    return (
      outputs.find(
        (output) =>
          (output.expression.kind === "voltage" ||
            output.expression.kind === "current") &&
          simulationProbeTargetKey(output.expression) === key &&
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(output.label),
      )?.label ?? null
    );
  }
  if (expression.kind === "constant") return String(expression.value);
  if ("operand" in expression) {
    const operand = formatOutputExpression(expression.operand, outputs);
    if (!operand) return null;
    if (expression.kind === "negate") return `-(${operand})`;
    const functions = {
      magnitude: "mag",
      db20: "db20",
      phase: "phase",
      real: "real",
      imaginary: "imag",
      absolute: "abs",
    } as const;
    return `${functions[expression.kind]}(${operand})`;
  }
  const left = formatOutputExpression(expression.left, outputs);
  const right = formatOutputExpression(expression.right, outputs);
  if (!left || !right) return null;
  const operators = {
    add: "+",
    subtract: "-",
    multiply: "*",
    divide: "/",
  } as const;
  return `(${left} ${operators[expression.kind]} ${right})`;
}

function ProbeSelect({
  label,
  placeholder,
  options,
  selectedKeys,
  onAdd,
  trailingAction,
}: {
  label: string;
  placeholder: string;
  options: readonly SimulationProbeOption[];
  selectedKeys: ReadonlySet<string>;
  onAdd(option: SimulationProbeOption): void;
  trailingAction?: ReactNode;
}) {
  const selectId = useId();
  return (
    <div className="simulation-probe-select">
      <label htmlFor={selectId}>{label}</label>
      <span className="simulation-probe-control">
        <select
          id={selectId}
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
              disabled={selectedKeys.has(option.key)}
            >
              {option.label}
            </option>
          ))}
        </select>
        {trailingAction}
      </span>
    </div>
  );
}

function simulationArtifactCategory(artifact: ArtifactRef): string {
  const name = artifact.name.toLocaleLowerCase();
  if (name.endsWith(".cir") || name.endsWith(".spi")) return "Netlist";
  if (name.endsWith(".raw") || name.endsWith(".csv")) return "Results";
  if (name.endsWith(".json")) return "Evidence";
  if (name.endsWith(".log") || name.endsWith(".txt")) return "Log";
  return "Other";
}

function formatArtifactSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(byteLength < 10_240 ? 1 : 0)} KB`;
}
