import { useId } from "react";

import { acResponseSvg, type AcTrace } from "./ac-response-plot";

/**
 * The SPICE simulation surface (ADR 0055).
 *
 * Three product commitments from the ADR shape this file, and none of them
 * are cosmetic:
 *
 * 1. **Refusal is a diagnosis.** A circuit that cannot be simulated greys the
 *    action out *before* anyone runs it, and names the instances responsible.
 *    A refusal that does not say which instance is in the way gives the author
 *    nowhere to go.
 * 2. **The testbench is the author's.** No templates, no examples, no inferred
 *    analysis. What this panel does say is the mechanical fact of our own
 *    interface — the path the circuit netlist arrives at — because that is
 *    documentation of what we do, not a guess at what the author wants to
 *    prove.
 * 3. **The circuit leaves this machine.** Stated on the panel, next to the
 *    action that does it, rather than in a document nobody opens.
 */

/**
 * What the panel needs to know about simulatability. Deliberately a view
 * model rather than a domain contract: the projection that decides this lives
 * in the model layer, and an adapter maps it onto these three cases.
 */
export type SimulatabilityView =
  | { kind: "ready" }
  | {
      kind: "blocked";
      /** Every instance standing in the way, each with its own reason. */
      blockers: readonly { instanceId: string; reason: string }[];
    }
  | { kind: "checking" };

export type SimulationRunState =
  | { kind: "idle" }
  | { kind: "running" }
  /** ngspice's own output, verbatim. Not summarised, not classified. */
  | { kind: "failed"; log: string }
  | {
      kind: "done";
      operatingPoint?: ReadonlyMap<string, number>;
      acTraces?: readonly AcTrace[];
      /** Kept even on success: warnings are where convergence trouble shows. */
      log: string;
    };

export interface SpiceSimulationPanelProps {
  simulatability: SimulatabilityView;
  run: SimulationRunState;
  testbench: string;
  onTestbenchChange: (value: string) => void;
  onRun: () => void;
  /** Where the exported circuit netlist appears to the testbench. */
  circuitIncludePath: string;
  /** Absent until the hosted surface is configured; the notice adapts. */
  runsLocally?: boolean;
}

function BlockedList({
  blockers,
}: {
  blockers: readonly { instanceId: string; reason: string }[];
}) {
  return (
    <section aria-label="Why this circuit cannot be simulated">
      <p className="simulation-blocked-lead">
        {blockers.length === 1
          ? "One instance has no device model behind it:"
          : `${blockers.length} instances have no device model behind them:`}
      </p>
      <ul className="simulation-blockers" data-testid="simulation-blockers">
        {blockers.map((blocker) => (
          <li key={blocker.instanceId}>
            <b>{blocker.instanceId}</b> — {blocker.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultView({ run }: { run: SimulationRunState }) {
  if (run.kind === "idle") return null;
  if (run.kind === "running") {
    return <p className="simulation-status">Running…</p>;
  }
  if (run.kind === "failed") {
    return (
      <section aria-label="Simulator output">
        <p className="simulation-status simulation-failed">
          ngspice did not finish. Its output follows exactly as it was produced.
        </p>
        <pre className="simulation-log" data-testid="simulation-log">
          {run.log}
        </pre>
      </section>
    );
  }
  const acMagnitudeSvg = run.acTraces?.length
    ? acResponseSvg(
        run.acTraces,
        { width: 640, height: 220 },
        { kind: "magnitude" },
      )
    : null;
  const acPhaseSvg = run.acTraces?.length
    ? acResponseSvg(
        run.acTraces,
        { width: 640, height: 220 },
        { kind: "phase" },
      )
    : null;
  return (
    <section aria-label="Simulation result">
      {run.operatingPoint && run.operatingPoint.size > 0 ? (
        <p className="simulation-status" data-testid="simulation-op-summary">
          Operating point solved: {run.operatingPoint.size} node
          {run.operatingPoint.size === 1 ? "" : "s"}. Named nets carry their
          voltage on the canvas; select or hover any other net to read it.
        </p>
      ) : null}
      {acMagnitudeSvg && acPhaseSvg ? (
        <div className="simulation-ac-plot" data-testid="simulation-ac-plot">
          <strong>Magnitude</strong>
          <div dangerouslySetInnerHTML={{ __html: acMagnitudeSvg }} />
          <strong>Phase</strong>
          <div dangerouslySetInnerHTML={{ __html: acPhaseSvg }} />
        </div>
      ) : null}
      <pre className="simulation-log" data-testid="simulation-log">
        {run.log}
      </pre>
    </section>
  );
}

export function SpiceSimulationPanel({
  simulatability,
  run,
  testbench,
  onTestbenchChange,
  onRun,
  circuitIncludePath,
  runsLocally = false,
}: SpiceSimulationPanelProps) {
  const testbenchId = useId();
  const blocked = simulatability.kind === "blocked";
  const checking = simulatability.kind === "checking";
  const empty = testbench.trim().length === 0;
  const running = run.kind === "running";
  const disabled = blocked || checking || empty || running;

  return (
    <section
      className="simulation-panel"
      aria-label="SPICE simulation"
      data-testid="spice-simulation-panel"
    >
      {blocked ? <BlockedList blockers={simulatability.blockers} /> : null}

      <div className="simulation-testbench">
        <label htmlFor={testbenchId}>Testbench</label>
        <p className="simulation-hint">
          Your testbench, your analysis — we supply the circuit and run the
          simulator, nothing else. The exported netlist is available to it at{" "}
          <code>{circuitIncludePath}</code>.
        </p>
        <textarea
          id={testbenchId}
          data-testid="simulation-testbench"
          className="simulation-testbench-input"
          spellCheck={false}
          rows={18}
          value={testbench}
          onChange={(event) => onTestbenchChange(event.currentTarget.value)}
        />
      </div>

      <p className="simulation-privacy" data-testid="simulation-privacy">
        {runsLocally
          ? "This runs on your machine: the circuit and testbench stay here."
          : "Running sends your circuit and testbench to a hosted simulator, so they leave this machine. Use the local host if that is not acceptable for this design."}
      </p>

      <button
        type="button"
        data-testid="simulation-run"
        onClick={onRun}
        disabled={disabled}
      >
        {running ? "Running…" : "Run simulation"}
      </button>

      <ResultView run={run} />
    </section>
  );
}
