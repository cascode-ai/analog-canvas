/**
 * Simulation on the machine the circuit is already on.
 *
 * ADR 0055 commits to two surfaces behind one interface: a container in the
 * cloud, and this. They differ only in where ngspice lives — same deck, same
 * result shape, same refusal to invent a testbench. The privacy argument is
 * the reason this one exists: a circuit that may not be uploaded can still be
 * simulated by whoever holds it.
 *
 * The simulator is the user's own install, not one we ship. That is a feature:
 * their ngspice, their PDK, their version, and no upload.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSimulationDeck,
  classifySimulationOutcome,
  readNgspiceDiagnostics,
  resolveTimeoutMs,
  type ModelLibrarySelection,
  type SimulationResult,
} from "@icm/spice-run";

export interface LocalSimulationOptions {
  /** The simulator binary; the user's own install by default. */
  ngspicePath?: string;
  /** Explicit model-library directive, path, and optional section. */
  modelLibrary?: ModelLibrarySelection | null;
}

/**
 * Why a local run could not even start. Distinct from a circuit that failed,
 * because "ngspice is not installed" is about the machine and a designer
 * should never read it as a statement about their design.
 */
export interface LocalSimulatorUnavailable {
  kind: "simulator-unavailable";
  message: string;
}

export type LocalSimulationOutcome =
  { kind: "ran"; result: SimulationResult } | LocalSimulatorUnavailable;

function runProcess(
  binary: string,
  deckPath: string,
  timeoutMs: number,
): Promise<{
  log: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  spawnError: Error | null;
}> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timedOut = false;
    let spawnError: Error | null = null;
    const child = execFile(
      binary,
      ["-b", deckPath],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        // ENOENT means no ngspice on this machine, which is a different
        // answer from any circuit outcome and is reported as one.
        if (
          error &&
          (error as NodeJS.ErrnoException).code === "ENOENT" &&
          !timedOut
        ) {
          spawnError = error;
        }
        resolve({
          log: `${stdout ?? ""}${stderr ?? ""}`,
          exitCode: timedOut
            ? null
            : typeof error?.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          timedOut,
          durationMs: Date.now() - startedAt,
          spawnError,
        });
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("exit", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
  });
}

export async function simulateLocally(
  request: { netlist: string; testbench: string; timeoutMs?: number },
  options: LocalSimulationOptions = {},
): Promise<LocalSimulationOutcome> {
  const binary = options.ngspicePath ?? process.env.NGSPICE_BIN ?? "ngspice";
  const timeoutMs = resolveTimeoutMs(request.timeoutMs);
  const deck = buildSimulationDeck(request, options.modelLibrary ?? null);

  const directory = await mkdtemp(join(tmpdir(), "icm-local-sim-"));
  const deckPath = join(directory, "deck.cir");
  try {
    await writeFile(deckPath, deck, "utf8");
    const run = await runProcess(binary, deckPath, timeoutMs);
    if (run.spawnError) {
      return {
        kind: "simulator-unavailable",
        message: `No simulator at "${binary}". Install ngspice, or set NGSPICE_BIN to its path.`,
      };
    }
    const diagnostics = readNgspiceDiagnostics(run.log);
    return {
      kind: "ran",
      result: {
        outcome: classifySimulationOutcome(diagnostics, {
          timedOut: run.timedOut,
          timeoutMs,
          exitCode: run.exitCode,
        }),
        diagnostics,
        log: run.log,
        durationMs: run.durationMs,
      },
    };
  } finally {
    // The deck is the user's circuit; it does not outlive the run.
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
