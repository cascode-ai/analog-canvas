import { useEffect, useRef, useState } from "react";
import {
  SimulationSetupSchema,
  type CircuitProject,
  type SimulationSetup,
} from "@icm/model";
import type {
  ArtifactRef,
  Capabilities,
  Prepared,
  Run,
  SimulationReply,
} from "@icm/simulation-service/contract";
import { downloadTextArtifact } from "../../document/project-file-service";
import type { BrowserSimulationSession } from "./browser-simulation-session";
import { acResponseSvg } from "./ac-response-plot";
import {
  deriveSimulationProbeOptions,
  simulationProbeTargetKey,
  type SimulationProbeOption,
} from "./simulation-probe-options";

export interface SpiceSimulationSurfaceProps {
  open: boolean;
  project: CircuitProject;
  activeDocumentId: string;
  draftContext?: {
    readonly dutDocumentId: string;
    readonly rootDocumentId: string;
  };
  session: BrowserSimulationSession;
  onClose(): void;
  onSaveSetup(setup: SimulationSetup | null): boolean;
  onOpenCell(documentId: string): void;
  onNewTestbench(): void;
}

/** A projection of the same prepare/start/read/cancel service used by MCP.
 * The canvas remains the editor for sources, connections and DUT instances. */
export function SpiceSimulationSurface(props: SpiceSimulationSurfaceProps) {
  const { session, project, open } = props;
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
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
      setError(
        `${reply.error.code}: ${reply.error.message}${reply.error.diagnostics?.map((d) => `\n${d.code}: ${d.message}`).join("") ?? ""}`,
      );
    } else if ("run" in reply) {
      setRun(reply.run);
      setError("");
    } else if ("prepared" in reply) {
      setPrepared(reply.prepared);
      setError("");
    } else if ("capabilities" in reply) {
      setCapabilities(reply.capabilities);
      setError("");
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
    setError("");
    try {
      const reply = await session.handle({
        operation: "prepare",
        source: { kind: "structured" },
      });
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
        setError(chunk.error.message);
        return;
      }
      if (!("text" in chunk)) return;
      text += chunk.text;
      offset = chunk.nextOffset;
    }
    const result = downloadTextArtifact(text, artifact.name);
    if (result.status === "failed") setError(result.message);
  };
  const running = run && ["running", "cancelling"].includes(run.state);
  const activeCell = project.documents.find(
    (candidate) => candidate.id === props.activeDocumentId,
  );
  const draftDut = project.documents.find(
    (candidate) => candidate.id === props.draftContext?.dutDocumentId,
  );
  const draftRoot = project.documents.find(
    (candidate) => candidate.id === props.draftContext?.rootDocumentId,
  );
  const savedRoot = project.documents.find(
    (candidate) => candidate.id === project.simulation?.input.rootDocumentId,
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
  return (
    <section
      hidden={!open}
      className="spice-simulation-surface"
      aria-label="Analog simulation"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
    >
      <header>
        <strong>Simulation · Preview</strong>
        <button onClick={props.onClose} aria-label="Close simulation">
          ×
        </button>
      </header>
      <div className="spice-simulation-body">
        <p>
          Build the testbench on the canvas. Source DC/AC values live in
          instance Properties. Run sends the prepared circuit to the configured
          simulator.
        </p>
        <div className="spice-simulation-actions">
          <button onClick={props.onNewTestbench}>New Testbench Cell…</button>
          {project.simulation && (
            <button
              onClick={() => {
                props.onOpenCell(project.simulation!.input.rootDocumentId);
                props.onClose();
              }}
            >
              Edit testbench
            </button>
          )}
        </div>
        <p data-testid="simulation-cell-flow">
          {props.draftContext ? (
            <>
              DUT: <strong>{draftDut?.name ?? "Missing Cell"}</strong>
              {" → "}Symbol View{" → "}Testbench:{" "}
              <strong>{draftRoot?.name ?? "Missing Cell"}</strong>
            </>
          ) : project.simulation ? (
            <>
              Testbench: <strong>{savedRoot?.name ?? "Missing Cell"}</strong>
              {activeCell && activeCell.id !== savedRoot?.id
                ? ` · editing ${activeCell.name}`
                : ""}
            </>
          ) : (
            <>
              DUT: <strong>{activeCell?.name ?? "Missing Cell"}</strong>
              {" → "}Symbol View:{" "}
              {activeCell?.presentation.cellSymbol
                ? "reviewed"
                : "auto-derived"}
              {" → "}create a Testbench
            </>
          )}
        </p>
        <SetupEditor
          key={
            JSON.stringify(project.simulation) ??
            `unsaved:${props.activeDocumentId}`
          }
          {...props}
          capabilities={capabilities}
          onDirty={setDirty}
          onError={setError}
        />
        <div className="spice-simulation-actions">
          <button
            disabled={busy || !!running || dirty || !project.simulation}
            onClick={() => void execute(false)}
          >
            Prepare deck
          </button>
          <button
            disabled={busy || !!running || dirty || !project.simulation}
            onClick={() => void execute(true)}
          >
            Run
          </button>
          <button
            disabled={!running || run.state === "cancelling"}
            onClick={() =>
              void session
                .handle({ operation: "cancel", runId: run!.id })
                .then(receive)
            }
          >
            Cancel run
          </button>
        </div>
        {dirty && <p>Apply setup changes before running.</p>}
        {capabilities?.configured === false && (
          <p>
            Simulator not configured. You can still edit the Project and setup.
          </p>
        )}
        <p role="status">
          {busy
            ? "Preparing…"
            : run
              ? `${run.state}${run.result ? ` · ${run.result.outcome.status}` : ""}`
              : prepared
                ? "Deck prepared"
                : "No run yet"}
        </p>
        {error && <pre role="alert">{error}</pre>}
        {error && run && (
          <button
            onClick={() =>
              void session
                .handle({ operation: "read", runId: run.id })
                .then(receive)
            }
          >
            Refresh run status
          </button>
        )}
        {run?.state === "lost" && (
          <p>
            The executor response is unknown. This run was not automatically
            resubmitted; inspect its evidence before choosing a new run.
          </p>
        )}
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
        {prepared?.warnings.map((warning, i) => (
          <p key={i}>{warning}</p>
        ))}
        {run?.inputStatus === "changed" && (
          <p role="alert">
            Result belongs to an earlier Project revision. Run again to use the
            current circuit.
          </p>
        )}
        {run?.error && (
          <pre role="alert">
            {run.error.code}: {run.error.message}
          </pre>
        )}
        {run?.result && (
          <>
            {run.resultPreview && (
              <p>
                Result preview is bounded. Export artifacts for complete data.
              </p>
            )}
            {run.result.data?.analyses.map((analysis, i) => (
              <section
                key={i}
                aria-label={`${analysis.analysis.toUpperCase()} results`}
              >
                <h3>{analysis.plotName}</h3>
                {analysis.analysis === "op" && (
                  <table>
                    <thead>
                      <tr>
                        <th>Vector</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.probes.map((p) => (
                        <tr key={p.name}>
                          <td>{p.name}</td>
                          <td>
                            {p.value.toPrecision(6)} {p.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {analysis.analysis === "ac" && (
                  <div
                    className="spice-ac-plot"
                    dangerouslySetInnerHTML={{
                      __html:
                        acResponseSvg(
                          analysis.probes.map((p) => ({
                            label: p.name,
                            points: analysis.frequencyHz.map(
                              (frequency, index) => ({
                                frequency,
                                magnitudeDb:
                                  20 *
                                  Math.log10(
                                    Math.max(
                                      Math.hypot(
                                        p.real[index] ?? 0,
                                        p.imag[index] ?? 0,
                                      ),
                                      1e-30,
                                    ),
                                  ),
                                phaseDeg:
                                  (Math.atan2(
                                    p.imag[index] ?? 0,
                                    p.real[index] ?? 0,
                                  ) *
                                    180) /
                                  Math.PI,
                              }),
                            ),
                          })),
                          { width: 640, height: 320 },
                        ) ?? "",
                    }}
                  />
                )}
              </section>
            ))}
            <details>
              <summary>Diagnostics and console</summary>
              <pre>
                {run.result.diagnostics.map((d) => d.text).join("\n")}
                {"\n"}
                {run.result.log}
              </pre>
            </details>
          </>
        )}
        {artifactGroups.map((group) => (
          <details open key={group.label} aria-label={group.label}>
            <summary>{group.label}</summary>
            <small>{group.identity}</small>
            {group.artifacts.map((a) => (
              <button key={a.id} onClick={() => void download(a)}>
                {a.name}
              </button>
            ))}
          </details>
        ))}
      </div>
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
  onError,
}: SpiceSimulationSurfaceProps & {
  capabilities: Capabilities | undefined;
  onDirty(value: boolean): void;
  onError(value: string): void;
}) {
  const saved = project.simulation?.input;
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
  useEffect(() => {
    onDirty(false);
  }, []);
  return (
    <details open={!saved}>
      <summary>Setup</summary>
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
            onError(parsed.error.issues.map((i) => i.message).join("\n"));
            return;
          }
          if (onSaveSetup(parsed.data)) {
            onDirty(false);
            onError("");
          } else
            onError(
              "Setup was not applied. See the editor status; your draft is retained.",
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
          <input
            name="profileId"
            required
            list="simulation-profiles"
            defaultValue={
              saved?.environment.profileId ??
              capabilities?.profiles[0]?.id ??
              ""
            }
          />
        </label>
        <datalist id="simulation-profiles">
          {capabilities?.profiles.map((p) => (
            <option key={p.id} value={p.id} />
          ))}
        </datalist>
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
        <label>
          <input
            name="op"
            type="checkbox"
            defaultChecked={
              !saved || saved.analyses.some((a) => a.kind === "op")
            }
          />
          Operating point (OP)
        </label>
        <label>
          <input name="ac" type="checkbox" defaultChecked={!!ac} />
          AC sweep
        </label>
        <label>
          Sweep
          <select name="sweep" defaultValue={ac?.sweep ?? "dec"}>
            <option value="dec">Decade</option>
            <option value="oct">Octave</option>
            <option value="lin">Linear</option>
          </select>
        </label>
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
        <ProbeSelect
          label="Add voltage probe"
          placeholder="Choose a Net in the testbench hierarchy"
          options={probeOptions.voltage}
          probes={probes}
          onAdd={(option) => {
            setProbes([...probes, probeFromOption(option)]);
            onDirty(true);
          }}
        />
        <ProbeSelect
          label="Add source-current probe"
          placeholder="Choose a voltage source"
          options={probeOptions.sourceCurrent}
          probes={probes}
          onAdd={(option) => {
            setProbes([...probes, probeFromOption(option)]);
            onDirty(true);
          }}
        />
        <ul>
          {probes.map((p) => (
            <li key={p.id}>
              {probeLabels.get(simulationProbeTargetKey(p)) ??
                `Unavailable: ${p.kind === "net-voltage" ? p.netId : p.instanceId}${p.occurrence.length ? ` (${p.occurrence.join("/")})` : ""}`}
              <button
                type="button"
                onClick={() => {
                  setProbes(probes.filter((v) => v.id !== p.id));
                  onDirty(true);
                }}
              >
                Remove probe
              </button>
            </li>
          ))}
        </ul>
        <p>Sources are edited on the testbench canvas.</p>
        <button type="submit">Apply setup</button>
        {saved && (
          <button type="button" onClick={() => onSaveSetup(null)}>
            Delete setup
          </button>
        )}
      </form>
    </details>
  );
}

function probeFromOption(
  option: SimulationProbeOption,
): SimulationSetup["input"]["probes"][number] {
  const target = option.target;
  if (target.kind === "net-voltage") {
    return {
      id: crypto.randomUUID(),
      kind: target.kind,
      documentId: target.documentId,
      netId: target.netId,
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
}: {
  label: string;
  placeholder: string;
  options: readonly SimulationProbeOption[];
  probes: SimulationSetup["input"]["probes"];
  onAdd(option: SimulationProbeOption): void;
}) {
  const selected = new Set(probes.map(simulationProbeTargetKey));
  return (
    <label>
      {label}
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
    </label>
  );
}
