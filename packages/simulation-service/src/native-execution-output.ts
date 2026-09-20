import {
  classifySimulationOutcome,
  createSimulationInputMetadata,
  readVacaskSimulationData,
  type SimulationDiagnostic,
  type SimulationEnvironmentMetadata,
} from "@icm/spice-run";
import { validateExecutionOutput, type ExecutionInput } from "./executor.js";
import { inspectNativeAnalyses } from "./native-source-analysis.js";
import { vacaskPostprocessPlots } from "./vacask-postprocess-plots.js";

/** Process/collector facts from the native harness, not another Run resource. */
export interface NativeJobObservation {
  execution: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    cancelled: boolean;
    spawnError: { code: string; message: string } | null;
    durationMs: number;
  };
  /** Actual supervisor ceiling, after defaulting/clamping the request. */
  timeoutMs: number;
  rawfiles: { path: string; text: string }[];
  executedFiles: { path: string; text: string }[];
  diagnostics: SimulationDiagnostic[];
  truncated: boolean;
}

/** The pinned CLI mixes errors with normal stdout and can exit zero after a
 * failed analysis. Keep native text/locations; do not reuse ngspice heuristics.
 * Located status blocks and known nonlocated failures are supplementary to
 * required output evidence, not a claim to parse every native/model message. */
function nativeDiagnostics(log: string): SimulationDiagnostic[] {
  const lines = log.split(/\r?\n/u);
  const messages = new Map<string, SimulationDiagnostic>();
  const add = (text: string, warning: boolean) => {
    const droppedInput = /^Warning, parameter '.+' not found\. Ignored\./u.test(
      text,
    );
    messages.set(text, {
      severity: warning ? "warning" : "error",
      text,
      ...(droppedInput ? { droppedInput: true } : {}),
    });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const warning = /^Warning\b/iu.test(line);
    if (
      warning ||
      /^(?:Parser syntax error|Analysis type '.+' not found\.|Master '.+' not found\.|Node '.+' not found\.|Failed to bind analysis outputs\.|Command not found\.|Error\b|Fatal\b|Timestep too small\.|Operating point analysis failed\.|Initial OP analysis failed\.|Homotopy failed,)/iu.test(
        line,
      )
    )
      add(line, warning);
    // VACASK Loc::toString: original source, caret, then line:column and file.
    if (
      /^\d+:\d+ \(0x[\da-f]+\) in /iu.test(line) &&
      /^\s*\^/u.test(lines[i - 1] ?? "") &&
      i >= 3
    ) {
      const message = lines[i - 3]!;
      messages.delete(message);
      add(lines.slice(i - 3, i + 1).join("\n"), /^Warning\b/iu.test(message));
    }
  }
  return [...messages.values()];
}

/** Shared native result assembly for local and hosted adapters. Source-derived
 * record meaning and the same numeric reader feed GUI, CSV and MCP. A partial
 * result is retained as evidence, never promoted to a successful whole run. */
export async function assembleNativeExecutionOutput(
  input: ExecutionInput,
  job: NativeJobObservation,
  environment: SimulationEnvironmentMetadata,
) {
  const execution = job.execution;
  const log =
    execution.stdout +
    (execution.stdout && execution.stderr ? "\n" : "") +
    execution.stderr;
  const diagnostics: SimulationDiagnostic[] = [
    // Native causes precede collector consequences (e.g. absent output files).
    // Preserve both, including original source/caret location blocks.
    ...nativeDiagnostics(log),
    ...job.diagnostics,
  ];
  const error = (text: string) => diagnostics.push({ severity: "error", text });
  if (execution.spawnError)
    error(`VACASK could not start (${execution.spawnError.code}).`);
  else if (execution.cancelled)
    error(
      "VACASK execution was cancelled; any retained records are partial evidence.",
    );
  else if (!execution.timedOut && execution.signal)
    error(`VACASK was terminated by ${execution.signal}.`);
  else if (!execution.timedOut && execution.exitCode !== 0)
    error(`VACASK exited with code ${execution.exitCode ?? "unknown"}.`);
  if (job.truncated)
    error(
      "Native output was truncated; numeric results were withheld. Inspect the retained artifacts and reduce output or raise an authorized limit.",
    );

  const plan = inspectNativeAnalyses({
    kind: "source",
    entry: input.entryPath!,
    configPath: "experiment.json",
    files: input.files,
    dependencies: input.dependencies,
    circuitBindings: [],
  });
  diagnostics.push(
    ...plan.warnings.map((text) => ({ severity: "warning" as const, text })),
  );
  let data;
  const plots = vacaskPostprocessPlots(log, plan.projections);
  diagnostics.push(...plots.diagnostics);
  const dropped = diagnostics.some((d) => d.droppedInput);
  if (
    !job.truncated &&
    !dropped &&
    job.executedFiles.length &&
    (job.rawfiles.length || plots.projections.length)
  ) {
    const reading = readVacaskSimulationData(job.rawfiles, plots.projections);
    diagnostics.push(...reading.diagnostics);
    if (reading.status === "read") data = reading.data;
  }
  if (dropped)
    diagnostics.push({
      severity: "warning",
      text: "VACASK ignored submitted parameters; numeric results were withheld because they may describe a different circuit.",
    });
  if (!data && !diagnostics.some((d) => d.severity === "error") && !dropped) {
    // No requested numerical projection is legal for a native control program,
    // but arbitrary nonempty output/just a version banner is not execution proof.
    if (!/^Simulating: /mu.test(execution.stdout))
      error("No evidence that VACASK accepted the submitted source.");
    else
      diagnostics.push({
        severity: "info",
        text: "No mapped numerical results; inspect native artifacts and execution log.",
      });
  }
  const result = {
    outcome: classifySimulationOutcome(diagnostics, {
      timedOut: execution.timedOut,
      timeoutMs: job.timeoutMs,
    }),
    diagnostics,
    log,
    durationMs: execution.durationMs,
    ...(data ? { data } : {}),
    metadata: {
      schemaVersion: 1,
      input: await createSimulationInputMetadata({
        inputRevision: input.inputRevision,
        netlist: input.netlist,
        testbench: input.testbench,
        deck: input.preparedDeck!,
      }),
      configuration: { modelLibrary: null },
      environment,
    },
  };
  return validateExecutionOutput(input, {
    result,
    rawfiles: job.rawfiles,
    executedFiles: job.executedFiles,
    cancelled: execution.cancelled,
    collectionStatus:
      job.truncated || job.diagnostics.some((d) => d.severity === "error")
        ? "partial"
        : "complete",
  });
}
